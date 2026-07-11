export interface LinkData {
  id?: string;
  platform: string;
  url: string;
}

export interface Author {
  id: string;
  name: string;
  title?: string;
  picture?: string;
  bio?: string;
  links?: LinkData[];
}

export interface OutlineItem {
  id: string;
  title: string;
  text: string;
}

export interface QuizOption {
  id: string;
  text: string;
  correct: boolean;
}

export interface QuizQuestion {
  id: string;
  q: string;
  options: QuizOption[];
}

export interface QuizAttempt {
  score: number;
  total: number;
  passed: boolean;
  answeredAt: string;
}

export interface Lesson {
  id: string;
  youtubeId?: string;
  youtubeUrl?: string;
  title: string;
  duration: string;
  authorId: string;
  summary: string;
  outline?: OutlineItem[];
  sources?: string;
  scripture?: string;
  quiz?: QuizQuestion[];
}

export interface Section {
  id: string;
  title: string;
  lessons: Lesson[];
}

export interface Level {
  id: string;
  title: string;
  sections: Section[];
}

export interface Course {
  id: string;
  featured: boolean;
  title: string;
  description: string;
  category: string;
  thumbnail: string;
  authorIds: string[];
  levels: Level[];
  issueCertificate?: boolean;
  requireQuiz?: boolean;
}
