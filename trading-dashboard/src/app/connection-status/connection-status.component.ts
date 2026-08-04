import { Component, OnInit, OnDestroy } from '@angular/core';
import { InternetStatusService } from '../internet-status.service';
import { CommonModule } from '@angular/common';
import { MatTooltipModule } from '@angular/material/tooltip';
import { HttpClient, HttpClientModule } from '@angular/common/http';
import { firstValueFrom, interval, Subscription } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { of } from 'rxjs';
import { environment } from '../../../src/environments/environment';
import { EventEmitter, Output } from '@angular/core';

interface ServerStatus {
  name: string;
  url: string;
  status: 'online' | 'offline' | 'checking';
  icon: string;
  tooltip: string;
  lastChecked?: Date;
}

interface MT5HealthResponse {
  status: string;
  service: string;
  mt5_connected:boolean;
  timestamp: string;
  port: string;
}

@Component({
  selector: 'app-connection-status',
  templateUrl: './connection-status.component.html',
  styleUrls: ['./connection-status.component.scss'],
  standalone: true,
  imports: [CommonModule, MatTooltipModule, HttpClientModule],
})
export class ConnectionStatusComponent implements OnInit, OnDestroy {
  @Output() reconnectRequested = new EventEmitter<void>();

  servers: ServerStatus[] = [
    {
      name: 'Angular',
      url: '/assets/images/angular_icon.gif',
      status: 'online',
      icon: '/assets/images/angular_icon.gif',
      tooltip: 'Angular Development Server'
    },
    {
      name: 'NotionProxy',
      url: `${environment.backendUrlNotion}/api/health`,
      status: 'checking',
      icon: '/assets/images/notion-icon.png',
      tooltip: 'Notion Proxy API Server'
    },
    {
      name: 'MT5 API',
      url: `${environment.backendUrlMt5}/api/health`,
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

    // Set up periodic status checks every 5 seconds
    this.statusCheckSubscription = interval(5000).subscribe(() => {
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
     await Promise.all(
    this.servers.map(async (server) => {
      if (server.name === 'Angular') {
        // Angular is always online if we're running this code
        server.status = 'online';
        server.lastChecked = new Date();
        return;
      }

      try {
        const response = await firstValueFrom(
          this.http.get<MT5HealthResponse>(server.url).pipe(
            catchError(error => {
              console.warn(`Connection check failed for ${server.name}:`, error);
              return of(null);
            })
          )
        );

        if (response && response.status === 'healthy') {
          server.status = 'online';
        } else {
          server.status = 'offline';
        }

      } catch (error) {
        server.status = 'offline';
      }

      server.lastChecked = new Date();
    })
  );
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

  // async reconnectMT5(): Promise<void> {
  //   const mt5Server = this.servers.find(s => s.name === 'MT5 API');
  //   if (mt5Server) {
  //     mt5Server.status = 'checking';
  //     await new Promise(resolve => setTimeout(resolve, 1000));
  //     await this.checkAllServerStatus();
  //   }
  // }
   reconnectMT5() {
    this.http.post(`${environment.backendUrlMt5}/api/start-reconnect`, {})
      .subscribe({
        next: (res) => {
          console.log(res);
          this.reconnectRequested.emit();
        },
        error: (err) => console.error(err)
      });
  }
}
