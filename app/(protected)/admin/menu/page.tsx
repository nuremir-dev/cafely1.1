import { requireAdminPage } from "@/features/auth/guards";
import { MenuAdminScreen } from "@/features/admin-menu/components/menu-admin-screen";
import { getAdminMenuData } from "@/features/admin-menu/server/manage-menu";

export const metadata = { title: "Меню" };

export default async function MenuAdminPage() {
  await requireAdminPage();
  const initialData = await getAdminMenuData();
  return <MenuAdminScreen initialData={initialData} />;
}
