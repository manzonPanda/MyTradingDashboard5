import { Component, OnInit, OnDestroy } from '@angular/core';
import { InternetStatusService } from '../internet-status.service';
import { CommonModule } from '@angular/common';
import { MatTooltipModule } from '@angular/material/tooltip';
import { HttpClient } from '@angular/common/http';
import { interval, Subscription } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { of } from 'rxjs';

interface ServerStatus {
  name: string;
  url: string;
  status: 'online' | 'offline' | 'checking';
  icon: string;
  tooltip: string;
  lastChecked?: Date;
}

@Component({
  selector: 'app-connection-status',
  templateUrl: './connection-status.component.html',
  styleUrls: ['./connection-status.component.scss'],
  standalone: true,
  imports: [CommonModule, MatTooltipModule],
})
export class ConnectionStatusComponent implements OnInit, OnDestroy {
  servers: ServerStatus[] = [
    {
      name: 'Angular',
      url: 'http://localhost:4200/assets/images/angular_icon.gif',
      status: 'online',
      icon: '/assets/images/angular_icon.gif',
      tooltip: 'Angular Development Server'
    },
    {
      name: 'NotionProxy',
      url: 'http://localhost:3000/api/health',
      status: 'checking',
      icon: '/assets/images/notion-icon.png',
      tooltip: 'Notion Proxy API Server'
    },
    {
      name: 'MT5 API',
      url: 'http://localhost:5000/health',
      status: 'checking',
      icon: '/assets/images/mt5_icon.png',
      tooltip: 'MetaTrader 5 API Server'
    }
  ];

  private statusCheckSubscription?: Subscription;
  private internetStatusSubscription?: Subscription;
  isInternetOnline = true;

  constructor(
    private statusService: InternetStatusService,
    private http: HttpClient
  ) {}

  ngOnInit(): void {
    // Monitor internet connection
    this.internetStatusSubscription = this.statusService.online$.subscribe(status => {
      this.isInternetOnline = status;
      if (!status) {
        // If no internet, mark all external servers as offline
        this.servers.forEach(server => {
          if (server.name !== 'Angular') {
            server.status = 'offline';
          }
        });
      }
    });

    // Initial status check
    this.checkAllServerStatus();

    // Set up periodic status checks every 10 seconds
    this.statusCheckSubscription = interval(10000).subscribe(() => {
      if (this.isInternetOnline) {
        this.checkAllServerStatus();
      }
    });
  }

  ngOnDestroy(): void {
    if (this.statusCheckSubscription) {
      this.statusCheckSubscription.unsubscribe();
    }
    if (this.internetStatusSubscription) {
      this.internetStatusSubscription.unsubscribe();
    }
  }

  private async checkAllServerStatus(): Promise<void> {
    for (const server of this.servers) {
      if (server.name === 'Angular') {
        // Angular is always online if we're running this code
        server.status = 'online';
        server.lastChecked = new Date();
        continue;
      }

      server.status = 'checking';

      try {
        const response = await this.http.get(server.url, {
          timeout: 3000,
          responseType: 'text'
        }).pipe(
          catchError(error => {
            console.warn(`Connection check failed for ${server.name}:`, error);
            return of(null);
          })
        ).toPromise();

        server.status = response !== null ? 'online' : 'offline';
        server.lastChecked = new Date();
      } catch (error) {
        server.status = 'offline';
        server.lastChecked = new Date();
      }
    }
  }

  getServerTooltip(server: ServerStatus): string {
    const status = server.status === 'online' ? 'Connected' :
                  server.status === 'offline' ? 'Disconnected' : 'Checking...';
    const lastChecked = server.lastChecked ?
      ` (Last checked: ${server.lastChecked.toLocaleTimeString()})` : '';
    return `${server.tooltip}: ${status}${lastChecked}`;
  }

  getOverallStatus(): 'online' | 'offline' | 'mixed' {
    const onlineCount = this.servers.filter(s => s.status === 'online').length;
    const totalCount = this.servers.length;

    if (onlineCount === totalCount) return 'online';
    if (onlineCount === 0) return 'offline';
    return 'mixed';
  }
}
