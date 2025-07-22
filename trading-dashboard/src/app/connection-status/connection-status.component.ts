// connection-status.component.ts
import { Component, OnInit } from '@angular/core';
import { InternetStatusService } from '../internet-status.service';
import { CommonModule } from '@angular/common';
import { MatTooltipModule } from '@angular/material/tooltip';


@Component({
  selector: 'app-connection-status',
  template: `
    <div [ngClass]="{ 'dot': true, 'online': isOnline, 'offline': !isOnline }"></div>
  `,
  styleUrls: ['./connection-status.component.scss'],
  standalone: true,
  imports: [CommonModule,
            MatTooltipModule
  ],
})
export class ConnectionStatusComponent implements OnInit {
  isOnline = true;

  constructor(private statusService: InternetStatusService) {}

  ngOnInit(): void {
    this.statusService.online$.subscribe(status => {
      this.isOnline = status;
    });
  }
}
