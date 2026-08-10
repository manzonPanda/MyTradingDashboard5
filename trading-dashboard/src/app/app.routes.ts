import { Routes } from '@angular/router';
import { DashboardComponent } from './dashboard/dashboard.component';
import { CodeAuditComponent } from './code-audit/code-audit.component';
import { AuraAiComponent } from './aura-ai/aura-ai.component';

export const routes: Routes = [
  { path: '', component: DashboardComponent },
  { path: 'settings', component: DashboardComponent },
  {
    path: 'code-audit',
    component: CodeAuditComponent
  },
  {
    path: 'aura-ai',
    component: AuraAiComponent
  },
  { path: '**', component: DashboardComponent }
];
