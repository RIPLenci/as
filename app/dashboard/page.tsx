import { AegisWorkspace } from '@/components/aegis/AegisWorkspace';
import { getAegisWorkspaceInitialProps } from '@/lib/server/initial-props';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const props = await getAegisWorkspaceInitialProps();
  return <AegisWorkspace {...props} />;
}
