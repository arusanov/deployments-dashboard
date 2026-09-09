import { Suspense } from "react";
import Dashboard from "@/deployments/dashboard";

export default function Page() {
  return (
    <Suspense fallback={<p>Loading deployments…</p>}>
      <Dashboard />
    </Suspense>
  );
}
