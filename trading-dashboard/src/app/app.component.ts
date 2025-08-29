import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { DashboardComponent } from './dashboard/dashboard.component';



@Component({
  selector: 'app-root',
  imports: [
      RouterOutlet,
      DashboardComponent,
  ],
  standalone: true,
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss']
})
export class AppComponent {
  title = 'trading-dashboard';
}
