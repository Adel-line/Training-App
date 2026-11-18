import { TabBar } from "./tab-bar";

export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      <main className="mx-auto w-full max-w-xl flex-1 px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[calc(var(--tabbar-h)+env(safe-area-inset-bottom)+1rem)]">
        {children}
      </main>
      <TabBar />
    </>
  );
}
