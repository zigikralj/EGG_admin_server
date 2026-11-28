import type { Response } from 'express';

export interface MessagingSSEEvent {
  type:
    | 'USER_PRESENCE'
    | 'MESSAGE_CREATED'
    | 'MESSAGE_UPDATED'
    | 'MESSAGE_DELETED'
    | 'READ_RECEIPT'
    | 'UNREAD_STATUS'
    | 'CONVERSATION_UPDATED'
    | 'REMOVED_FROM_CONVERSATION'
    | 'CONVERSATION_CLEARED'
    | 'MUTE_UPDATED'
    | 'DND_UPDATED'
    | 'NOTIFICATION';
  payload: any;
}

class MessagingSSEHub {
  private userSockets = new Map<string, Set<Response>>();
  private heartbeatInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.startHeartbeat();
  }

  public addClient(userId: string, res: Response): void {
    const wasOnline = this.isUserOnline(userId);
    let sockets = this.userSockets.get(userId);
    if (!sockets) {
      sockets = new Set<Response>();
      this.userSockets.set(userId, sockets);
    }
    sockets.add(res);

    // If transitioned from offline to online, broadcast presence change
    if (!wasOnline) {
      this.broadcastAll({
        type: 'USER_PRESENCE',
        payload: { userId, status: 'ONLINE' },
      });
    }
  }

  public removeClient(userId: string, res: Response): void {
    const sockets = this.userSockets.get(userId);
    if (!sockets) return;

    sockets.delete(res);
    if (sockets.size === 0) {
      this.userSockets.delete(userId);
      this.broadcastAll({
        type: 'USER_PRESENCE',
        payload: { userId, status: 'OFFLINE' },
      });
    }
  }

  public disconnectUser(userId: string): void {
    const sockets = this.userSockets.get(userId);
    if (!sockets || sockets.size === 0) return;

    this.userSockets.delete(userId);
    for (const res of sockets) {
      try {
        res.end();
      } catch {
        // Ignore already closed streams
      }
    }
    this.broadcastAll({
      type: 'USER_PRESENCE',
      payload: { userId, status: 'OFFLINE' },
    });
  }

  public isUserOnline(userId: string): boolean {
    const sockets = this.userSockets.get(userId);
    return Boolean(sockets && sockets.size > 0);
  }

  public getOnlineUserIds(): string[] {
    return Array.from(this.userSockets.keys());
  }

  public sendToUser(userId: string, event: MessagingSSEEvent): void {
    const sockets = this.userSockets.get(userId);
    if (!sockets || sockets.size === 0) return;

    const data = `event: ${event.type}\ndata: ${JSON.stringify(event.payload)}\n\n`;
    for (const res of sockets) {
      try {
        res.write(data);
      } catch (err) {
        // Connection died
        sockets.delete(res);
      }
    }
  }

  public sendToUsers(userIds: string[], event: MessagingSSEEvent): void {
    for (const userId of userIds) {
      this.sendToUser(userId, event);
    }
  }

  public broadcastAll(event: MessagingSSEEvent): void {
    const data = `event: ${event.type}\ndata: ${JSON.stringify(event.payload)}\n\n`;
    for (const [, sockets] of this.userSockets) {
      for (const res of sockets) {
        try {
          res.write(data);
        } catch {
          sockets.delete(res);
        }
      }
    }
  }

  private startHeartbeat(): void {
    // Ping all active connections every 25 seconds to keep proxies/firewalls alive
    this.heartbeatInterval = setInterval(() => {
      for (const [userId, sockets] of this.userSockets) {
        for (const res of sockets) {
          try {
            res.write(': keepalive\n\n');
          } catch {
            sockets.delete(res);
          }
        }
        if (sockets.size === 0) {
          this.userSockets.delete(userId);
          this.broadcastAll({
            type: 'USER_PRESENCE',
            payload: { userId, status: 'OFFLINE' },
          });
        }
      }
    }, 25_000);
    this.heartbeatInterval.unref();
  }
}

export const messagingSSEHub = new MessagingSSEHub();
