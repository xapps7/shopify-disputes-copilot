import DashboardPage from "@/app/dashboard/page";
import { OverviewPageShell } from "@/components/overview-page-shell";

type HomePageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function getSingleValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function HomePage({ searchParams }: HomePageProps) {
  const params = (await searchParams) ?? {};
  const shop = getSingleValue(params.shop);
  const host = getSingleValue(params.host);

  if (shop || host) {
    return <DashboardPage />;
  }

  return <OverviewPageShell />;
}
