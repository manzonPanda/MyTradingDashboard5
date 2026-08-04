import { Routes } from '@angular/router';
import { DashboardComponent } from './dashboard/dashboard.component';
import { ProfileSettingsComponent } from './settings/profile-settings.component';

export const routes: Routes = [
  { path: '', component: DashboardComponent },
  { path: 'settings', component: ProfileSettingsComponent },
  { path: '**', component: DashboardComponent }
];
