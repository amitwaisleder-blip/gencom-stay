import { useMemo } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { CoffeeDirectory } from "@/components/module/coffee-directory";
import { getStore } from "@/data";

import { useStoreData } from "./loader-helpers";

export default function CoffeeChatsRoute() {
  const loader = useMemo(() => async () => {
    const store = getStore();
    const [fullTimers, requests, interns] = await Promise.all([
      store.listFullTimers(),
      store.listCoffeeChatRequests(),
      store.listInterns(),
    ]);
    return { fullTimers, requests, interns: interns.filter((i) => i.status === "active") };
  }, []);
  const { data, loading } = useStoreData(loader);
  if (loading || !data) return <Skeleton className="h-[400px] w-full" />;
  return (
    <CoffeeDirectory
      fullTimers={data.fullTimers}
      requests={data.requests}
      interns={data.interns}
    />
  );
}
