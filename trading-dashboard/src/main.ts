import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component';
import { appConfig } from './app/app.config';
import { Builder } from '@builder.io/sdk';

const builder = new Builder('82c7cb2a49f347c382144b8a767f807a'); // Find this in builder.io account

Builder.registerComponent(AppComponent, {
  name: 'MyCard',
  inputs: [
    {
      name: 'title',
      type: 'string',
    },
    {
      name: 'content',
      type: 'string',
    },
  ],
});

bootstrapApplication(AppComponent, appConfig)
  .catch((err) => console.error(err));
