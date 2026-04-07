// ── ilink Bot API protocol types ──────────────────────────

export enum MessageType {
  USER = 1,
  BOT = 2,
}

export enum MessageState {
  NEW = 0,
  GENERATING = 1,
  FINISH = 2,
}

export enum MessageItemType {
  TEXT = 1,
  IMAGE = 2,
  VOICE = 3,
  FILE = 4,
  VIDEO = 5,
}

export interface TextItem {
  text?: string;
}

export interface CDNMedia {
  aes_key: string;
  encrypt_query_param: string;
  cdn_url?: string;
}

export interface ImageItem {
  cdn_media?: CDNMedia;
  aeskey?: string;
  media?: { encrypt_query_param: string; aes_key: string };
  url?: string;
  mid_size?: number;
  hd_size?: number;
}

export interface MessageItem {
  type: MessageItemType;
  text_item?: TextItem;
  image_item?: ImageItem;
}

export interface WeixinMessage {
  seq?: number;
  message_id?: number;
  from_user_id?: string;
  to_user_id?: string;
  create_time_ms?: number;
  message_type?: MessageType;
  message_state?: MessageState;
  item_list?: MessageItem[];
  context_token?: string;
}

export interface OutboundMessage {
  from_user_id: string;
  to_user_id: string;
  client_id: string;
  message_type: MessageType;
  message_state: MessageState;
  context_token: string;
  item_list: MessageItem[];
}

export interface GetUpdatesResp {
  ret?: number;
  retmsg?: string;
  sync_buf?: string;
  get_updates_buf?: string;
  msgs?: WeixinMessage[];
}

export interface AccountData {
  botToken: string;
  accountId: string;
  baseUrl: string;
  userId: string;
  createdAt: string;
}
