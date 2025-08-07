import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  standalone: true,
  template: `
    <div style="padding: 20px;">
      <h1>Trading Dashboard</h1>
      <p>Application is loading...</p>
      <router-outlet></router-outlet>
    </div>
  `,
  styles: [`
    h1 { color: #333; }
    p { color: #666; }
  `]
})
export class AppComponent {
  title = 'trading-dashboard';
}
