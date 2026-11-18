import { requireOwner } from "@/lib/auth";
import { TabBar } from "./tab-bar";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  await requireOwner();
  return (
    <>
      <main className="mx-auto w-full max-w-xl flex-1 px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[calc(var(--tabbar-h)+env(safe-area-inset-bottom)+1rem)]">
        {children}
      </main>
      <TabBar />
    </>
  );
}
