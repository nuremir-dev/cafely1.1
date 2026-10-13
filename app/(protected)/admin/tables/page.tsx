import { requireAdminPage } from "@/features/auth/guards";
import { TableMapEditor } from "@/features/tables/components/table-map-editor";
import { getTableMap } from "@/features/tables/server/table-map";

export const metadata = { title: "Карта столов" };

export default async function TablesPage() {
  await requireAdminPage();
  return <TableMapEditor initialMap={await getTableMap()} />;
}
