export interface Message {
  role: string;
  content: string;
}

export interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  titleGenerated?: boolean;
}

export interface DocItem {
  id: string;
  name: string;
  content: string;
  kind: 'txt' | 'md' | 'pdf';
  objectUrl?: string;
  blob?: Blob;
  pages?: Array<{ page: number; text: string }>;
  checked: boolean;
}
