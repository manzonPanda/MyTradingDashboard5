import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  OnInit
} from '@angular/core';

import {
  CodeAuditCss,
  CodeAuditFunction,
  CodeAuditReport
} from './models/code-audit.model';

import { CodeAuditService } from './services/code-audit.service';
import { FormsModule } from '@angular/forms';
import { CommonModule } from "@angular/common";
type AuditTab =
  | 'overview'
  | 'functions'
  | 'components'
  | 'css';


@Component({
  selector: 'app-code-audit',

  templateUrl: './code-audit.component.html',

  styleUrl: './code-audit.component.scss',

  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,

  imports: [
    FormsModule,CommonModule
  ]
})
export class CodeAuditComponent implements OnInit {

  report: CodeAuditReport | null = null;

  loading = true;

  error = '';

  activeTab: AuditTab = 'overview';

  searchTerm = '';

  statusFilter: 'all' | 'unused' | 'used' = 'all';

  selectedFunction: CodeAuditFunction | null = null;

  selectedCss: CodeAuditCss | null = null;


  constructor(
    private readonly auditService: CodeAuditService,
    private readonly cdr: ChangeDetectorRef
  ) {}


  ngOnInit(): void {

    this.loadReport();

  }


  loadReport(): void {

    this.loading = true;

    this.error = '';

    this.auditService
      .getReport()
      .subscribe({

        next: report => {

          this.report = report;

          this.loading = false;

          this.cdr.markForCheck();

        },

        error: error => {

          console.error(
            'Failed to load code audit report',
            error
          );

          this.error =
            'Unable to load code audit report.';

          this.loading = false;

          this.cdr.markForCheck();

        }

      });

  }


  setTab(tab: AuditTab): void {

    this.activeTab = tab;

    this.selectedFunction = null;

    this.selectedCss = null;

  }


  setStatusFilter(
    filter: 'all' | 'unused' | 'used'
  ): void {

    this.statusFilter = filter;

  }


  get filteredFunctions(): CodeAuditFunction[] {

    if (!this.report) {
      return [];
    }

    const search =
      this.searchTerm
        .trim()
        .toLowerCase();


    return this.report.functions.filter(
      item => {

        const matchesSearch =
          !search ||
          item.name.toLowerCase().includes(search) ||
          item.file.toLowerCase().includes(search);


        const matchesStatus =
          this.statusFilter === 'all' ||
          item.status === this.statusFilter;


        return (
          matchesSearch &&
          matchesStatus
        );

      }
    );

  }


  get filteredCss(): CodeAuditCss[] {

    if (!this.report) {
      return [];
    }

    const search =
      this.searchTerm
        .trim()
        .toLowerCase();


    return this.report.css.filter(
      item => {

        const matchesSearch =
          !search ||
          item.selector.toLowerCase().includes(search) ||
          item.file.toLowerCase().includes(search);


        const matchesStatus =
          this.statusFilter === 'all' ||
          item.status === this.statusFilter;


        return (
          matchesSearch &&
          matchesStatus
        );

      }
    );

  }


  selectFunction(
    item: CodeAuditFunction
  ): void {

    this.selectedFunction =
      this.selectedFunction === item
        ? null
        : item;

  }


  selectCss(
    item: CodeAuditCss
  ): void {

    this.selectedCss =
      this.selectedCss === item
        ? null
        : item;

  }


  get healthScore(): number {

    return this.report?.summary.healthScore ?? 0;

  }


  get healthLabel(): string {

    const score = this.healthScore;

    if (score >= 95) {
      return 'Excellent';
    }

    if (score >= 85) {
      return 'Good';
    }

    if (score >= 70) {
      return 'Needs Attention';
    }

    return 'Critical';

  }


  get healthDashOffset(): number {

    const circumference = 251.2;

    return circumference -
      (
        this.healthScore / 100
      ) * circumference;

  }


  trackByFunction(
    index: number,
    item: CodeAuditFunction
  ): string {

    return `${item.file}:${item.line}:${item.name}`;

  }


  trackByCss(
    index: number,
    item: CodeAuditCss
  ): string {

    return `${item.file}:${item.line}:${item.selector}`;

  }

}