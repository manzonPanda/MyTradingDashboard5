import { Routes } from '@angular/router';
import { DashboardComponent } from './dashboard/dashboard.component';
import { CodeAuditComponent } from './code-audit/code-audit.component';

export const routes: Routes = [
  { path: '', component: DashboardComponent },
  { path: 'settings', component: DashboardComponent },
  {
    path: 'code-audit',
    component: CodeAuditComponent
  },
  { path: '**', component: DashboardComponent }
];
