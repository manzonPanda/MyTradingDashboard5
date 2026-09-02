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
  {
    // /aura-ai is the Trading Behavior Engine workspace. It renders inside the
    // normal application shell (DashboardComponent) — same sidebar, header and
    // account context as every other workspace. The legacy AI-chat wrapper
    // (AuraAiComponent: New Chat / threads / Memories) was removed; the route
    // path is kept unchanged for deep links and existing bookmarks.
    path: 'aura-ai',
    component: DashboardComponent
  },
  { path: '**', component: DashboardComponent }
];

