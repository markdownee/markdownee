export type MessageType = 'info' | 'warning' | 'error';

export interface Message {
  type: MessageType;
  text: string;
}
