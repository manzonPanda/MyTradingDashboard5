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
import { io, Socket } from 'socket.io-client';

interface MT5AccountInfo {
  login: string | number | null;
  name: string | null;
  server: string | null;
  balance: number | null;
}

interface ServerStatus {
  name: string;
  url: string;
  status: 'online' | 'offline' | 'checking' | 'reconnecting';
  icon: string;
  tooltip: string;
  detail: string;
  account?: MT5AccountInfo;
  lastChecked?: Date;
}

interface MT5HealthResponse {
  status: string;
  service: string;
  mt5_connected: boolean;
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
      name: 'MT5 API',
      url: `${environment.backendUrlMt5}/api/health`,
      status: 'checking',
      icon: '/assets/images/mt5_icon.png',
      tooltip: 'MetaTrader 5 API Server',
      detail: 'Checking MT5 connection…'
    }
  ];

  private statusCheckSubscription?: Subscription;
  private internetStatusSubscription?: Subscription;
  private socket?: Socket;
  isInternetOnline = true;

  constructor(
    private statusService: InternetStatusService,
    private http: HttpClient
  ) {}

  ngOnInit(): void {
    this.internetStatusSubscription = this.statusService.online$.subscribe(status => {
      this.isInternetOnline = status;
      if (!status) {
        this.servers.forEach(server => {
          server.status = 'offline';
          server.detail = 'Disconnected';
        });
      }
    });

    this.connectToMT5Updates();
    this.checkAllServerStatus();

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
    this.socket?.disconnect();
  }

  private connectToMT5Updates(): void {
    this.socket = io(environment.backendUrlMt5, {
      transports: ['websocket'],
      upgrade: false
    });

    this.socket.on('account_info', (account: MT5AccountInfo) => {
      const server = this.servers[0];
      if (account?.login !== null && account?.login !== undefined) {
        server.account = {
          login: account.login,
          name: account.name ?? null,
          server: account.server ?? null,
          balance: Number.isFinite(Number(account.balance)) ? Number(account.balance) : null
        };
        server.status = 'online';
        server.detail = '';
      } else {
        server.account = undefined;
      }
    });
  }

  private async checkAllServerStatus(): Promise<void> {
     await Promise.all(
    this.servers.map(async (server) => {
      try {
        const response = await firstValueFrom(
          this.http.get<MT5HealthResponse>(server.url).pipe(
            catchError(error => {
              console.warn(`Connection check failed for ${server.name}:`, error);
              return of(null);
            })
          )
        );

        if (response?.status === 'healthy' && response.mt5_connected) {
          server.status = 'online';
          server.detail = '';
        } else {
          server.status = 'offline';
          server.detail = 'Disconnected';
        }

      } catch (error) {
        server.status = 'offline';
        server.detail = '';
      }

      server.lastChecked = new Date();
    })
  );
  }

  getServerTooltip(server: ServerStatus): string {
    const status = server.status === 'online' ? 'Connected' :
                  server.status === 'reconnecting' ? 'Reconnecting...' :
                  server.status === 'offline' ? 'Disconnected' : 'Checking...';
    const lastChecked = server.lastChecked ?
      ` (Last checked: ${server.lastChecked.toLocaleTimeString()})` : '';
    return `${server.tooltip}: ${status}${lastChecked}`;
  }

  reconnectMT5(): void {
    const server = this.servers[0];
    if (server.status === 'reconnecting') return;

    server.status = 'reconnecting';
    server.detail = 'Retrying…';
    this.http.post(`${environment.backendUrlMt5}/api/start-reconnect`, {})
      .subscribe({
        next: () => {
          server.detail = 'Retrying…';
          this.reconnectRequested.emit();
        },
        error: () => {
          server.status = 'offline';
          server.detail = 'Disconnected';
        }
      });
  }
}
