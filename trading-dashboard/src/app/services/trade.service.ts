import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';


@Injectable({
  providedIn: 'root'
})
export class TradeService {
  private apiUrl = 'http://localhost:5000/api'; // change if deployed
  constructor(private http: HttpClient) {}

  closeTrade(ticket: number): Observable<any> {
    return this.http.post(`${this.apiUrl}/close_trade`, { ticket });
  }

  closeAllTrades(): Observable<any> {
    return this.http.post(`${this.apiUrl}/close_all_trades`, {});
  }
}
