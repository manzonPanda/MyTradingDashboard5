import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component.minimal';
import { appConfig } from './app/app.config.minimal';

bootstrapApplication(AppComponent, appConfig)
  .catch((err) => console.error(err));
