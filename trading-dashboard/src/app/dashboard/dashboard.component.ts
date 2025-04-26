import { Component, importProvidersFrom } from '@angular/core';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatCardModule  } from '@angular/material/card';
import { CommonModule } from "@angular/common";
import { CalendarModule } from 'angular-calendar';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
    MatSlideToggleModule,
    MatCardModule,
    CommonModule,
    CalendarModule
  ],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss'
})
export class DashboardComponent {
  viewDate: Date = new Date();
  events = [];

  onDayClicked(date: Date) {
    alert('Clicked: ' + date.toDateString());
  }


}
