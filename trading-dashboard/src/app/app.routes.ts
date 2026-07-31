import { Routes } from '@angular/router';
import { DashboardComponent } from './dashboard/dashboard.component';

export const routes: Routes = [
  { path: '', component: DashboardComponent },
  { path: 'active-account', component: DashboardComponent },
  { path: 'notion-update', component: DashboardComponent },
  { path: 'trading-history', component: DashboardComponent }
];
