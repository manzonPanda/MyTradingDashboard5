import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

import { CodeAuditReport } from '../models/code-audit.model';

@Injectable({
  providedIn: 'root'
})
export class CodeAuditService {

  private readonly reportUrl = '/tools/code-audit-report.json';

  constructor(
    private readonly http: HttpClient
  ) {}

  getReport(): Observable<CodeAuditReport> {
    return this.http.get<CodeAuditReport>(
      this.reportUrl
    );
  }
}