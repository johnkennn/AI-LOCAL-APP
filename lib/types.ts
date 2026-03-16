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
