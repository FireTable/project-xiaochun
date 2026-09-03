import { createFileRoute } from '@tanstack/react-router';
import { App } from '@/App';

export const Route = createFileRoute('/')({
  component: IndexComponent,
});

function IndexComponent() {
  return <App />;
}
