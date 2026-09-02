import { Injectable } from '@angular/core';
import { getMessaging, getToken, onMessage } from 'firebase/messaging';
import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class FcmService {
  private messaging = getMessaging();

  constructor() {}

  /**
   * Requests browser notification permission and gets the FCM token.
   */
  async requestPermission(): Promise<string | null> {
    try {
      const permission = await Notification.requestPermission();

      if (permission !== 'granted') {
        console.warn('Notification permission not granted.');
        return null;
      }

            const token = await getToken(this.messaging, {
        // firebaseConfig may be absent in non-Firebase environments (e.g. local
        // dev / CI). Guard so a missing config yields vapidKey=undefined instead
        // of a TypeError, and satisfies strict typing.
        vapidKey: (environment as { firebaseConfig?: { vapidKey?: string } | undefined }).firebaseConfig?.vapidKey ?? '',
      });

      if (token) {
        // Store token in localStorage for later use
        localStorage.setItem('fcm_token', token);
        return token;
      } else {
        console.warn('No FCM token received.');
        return null;
      }
    } catch (err) {
      console.error('Error getting FCM token:', err);
      return null;
    }
  }

  /**
   * Listens for incoming foreground messages.
   */
  listen(): void {
    onMessage(this.messaging, (payload) => {
      // Optional: Show a notification popup manually
      if (payload.notification) {
        const { title, body, icon } = payload.notification;
        new Notification(title ?? 'Notification', {
          body: body ?? '',
          icon: icon ?? '/assets/icons/icon-72x72.png'
        });
      }
    });
  }
}
