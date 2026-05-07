import { Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
  selector: 'app-error-banner',
  standalone: true,
  imports: [],
  templateUrl: './error-banner.component.html',
  styleUrl: './error-banner.component.css',
})
export class ErrorBannerComponent {
  /** The canonical user-facing message to display. The component never receives raw payloads. */
  @Input({ required: true }) message!: string;
  /** Optional hint about severity — keeps the styling consistent. */
  @Input() severity: 'error' | 'warning' = 'error';

  @Output() dismiss = new EventEmitter<void>();

  onDismiss(): void {
    this.dismiss.emit();
  }
}
