import { ApplicationConfig, importProvidersFrom, provideZoneChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { routes } from './app.routes';
import { CalendarModule, DateAdapter } from 'angular-calendar';
import { adapterFactory } from 'angular-calendar/date-adapters/date-fns';

import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
import { provideFirebaseApp } from '@angular/fire/app';
import { provideFirestore, getFirestore } from '@angular/fire/firestore';
import { provideHttpClient } from '@angular/common/http';
import { provideCharts, withDefaultRegisterables } from 'ng2-charts';

const firebaseConfig = {
  apiKey: "AIzaSyB5-Z3aLRr-HyopLGF6kXDPR1DdOKoEI_Q",
  authDomain: "tradingdashboard-fce7d.firebaseapp.com",
  projectId: "tradingdashboard-fce7d",
  storageBucket: "tradingdashboard-fce7d.firebasestorage.app",
  messagingSenderId: "714112340582",
  appId: "1:714112340582:web:a2709e6fbc6c9c33ee53a7",
  measurementId: "G-1CZDEEM8R2"
};

export const appConfig: ApplicationConfig = {
  providers: [
    importProvidersFrom(
      CalendarModule.forRoot({
        provide: DateAdapter,
        useFactory: adapterFactory,
      })
    ),
    provideFirebaseApp(() => initializeApp(firebaseConfig)),
    provideFirestore(() => getFirestore()),
    provideHttpClient()
  ]
};
