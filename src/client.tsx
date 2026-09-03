import { hydrateRoot } from 'react-dom/client';
import { StartClient } from '@tanstack/react-start/client';
import '@/styles/main.css';

hydrateRoot(document, <StartClient />);
