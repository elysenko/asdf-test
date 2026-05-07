import {
  AfterViewChecked,
  Component,
  ElementRef,
  ViewChild,
  inject,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';

import { ErrorBannerComponent } from './error-banner.component';
import { WeatherResultCardComponent } from './weather-result-card.component';
import {
  ValidationErrorCode,
  WeatherErrorCode,
  WeatherErrorResponse,
  WeatherResult,
  WeatherSearchService,
} from './weather-search.service';

type SearchStatus = 'idle' | 'loading' | 'success' | 'error';

@Component({
  selector: 'app-search-page',
  standalone: true,
  imports: [FormsModule, ErrorBannerComponent, WeatherResultCardComponent],
  templateUrl: './search-page.component.html',
  styleUrl: './search-page.component.css',
})
export class SearchPageComponent implements AfterViewChecked {
  private readonly service = inject(WeatherSearchService);

  @ViewChild('resultRegion') resultRegion?: ElementRef<HTMLElement>;
  @ViewChild('errorBanner', { read: ElementRef }) errorBannerRef?: ElementRef<HTMLElement>;

  /** The bound input value. */
  city = '';
  /** Capped to 100 chars in the template via maxlength. */
  readonly maxCityLength = 100;

  /** Current state of the search. */
  status: SearchStatus = 'idle';
  /** Inline validation message (under the input). */
  validationMessage: string | null = null;
  /** Banner message for transport / upstream failures. */
  errorMessage: string | null = null;
  /** The successful result currently rendered. */
  result: WeatherResult | null = null;

  /** Suggested city chips shown on the empty state. */
  readonly suggestions: ReadonlyArray<string> = [
    'London',
    'Tokyo',
    'Springfield',
    'Paris',
    'Sydney',
  ];

  private requestSubscription?: Subscription;
  private focusTarget: 'result' | 'error' | null = null;

  get isLoading(): boolean {
    return this.status === 'loading';
  }

  onCityInput(): void {
    // Clear inline validation as soon as the user starts editing.
    if (this.validationMessage) {
      this.validationMessage = null;
    }
  }

  trySuggestion(name: string): void {
    this.city = name;
    this.onSubmit();
  }

  onSubmit(): void {
    if (this.isLoading) {
      return;
    }

    // Always re-run client-side validation; never call the backend with invalid input.
    const validation: ValidationErrorCode | null = this.service.validate(this.city);
    if (validation !== null) {
      this.validationMessage = this.service.validationMessage(validation);
      this.errorMessage = null;
      this.result = null;
      this.status = 'idle';
      return;
    }

    // Reset prior outcomes before issuing the request.
    this.validationMessage = null;
    this.errorMessage = null;
    this.status = 'loading';

    // Cancel any prior in-flight request to avoid a stale response winning.
    this.requestSubscription?.unsubscribe();

    this.requestSubscription = this.service.search(this.city).subscribe({
      next: (result) => {
        this.result = result;
        this.status = 'success';
        this.focusTarget = 'result';
      },
      error: (err: WeatherErrorResponse) => {
        // Defensive: if the backend ever returned an unknown shape, fall back to SERVICE_UNAVAILABLE
        // so we never surface a raw payload or stack trace.
        const code: WeatherErrorCode =
          err && typeof err === 'object' && 'code' in err && this.isKnownErrorCode(err.code)
            ? err.code
            : 'SERVICE_UNAVAILABLE';
        this.errorMessage = this.service.errorMessage(code);
        this.result = null;
        this.status = 'error';
        this.focusTarget = 'error';
      },
    });
  }

  dismissErrorBanner(): void {
    this.errorMessage = null;
    if (this.status === 'error') {
      this.status = 'idle';
    }
  }

  ngAfterViewChecked(): void {
    if (this.focusTarget === 'result' && this.resultRegion?.nativeElement) {
      this.resultRegion.nativeElement.focus({ preventScroll: false });
      this.focusTarget = null;
    } else if (this.focusTarget === 'error' && this.errorBannerRef?.nativeElement) {
      this.errorBannerRef.nativeElement.focus({ preventScroll: false });
      this.focusTarget = null;
    }
  }

  private isKnownErrorCode(code: unknown): code is WeatherErrorCode {
    return (
      code === 'NOT_FOUND' ||
      code === 'GEOCODER_UNAVAILABLE' ||
      code === 'WEATHER_UNAVAILABLE' ||
      code === 'SERVICE_UNAVAILABLE'
    );
  }
}
