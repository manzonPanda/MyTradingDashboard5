import { bootstrapApplication } from '@angular/platform-browser';
import { Component } from '@angular/core';

@Component({
  selector: 'app-root',
  standalone: true,
  template: '<h1>Hello Trading Dashboard</h1>'
})
export class AppComponent {}

bootstrapApplication(AppComponent)
  .catch(err => console.error(err));
