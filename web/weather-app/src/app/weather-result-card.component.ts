import { Component, Input } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { WeatherResult } from './weather-search.service';

@Component({
  selector: 'app-weather-result-card',
  standalone: true,
  imports: [DecimalPipe],
  templateUrl: './weather-result-card.component.html',
  styleUrl: './weather-result-card.component.css',
})
export class WeatherResultCardComponent {
  @Input({ required: true }) result!: WeatherResult;
}
