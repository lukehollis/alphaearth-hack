"use client";

import dynamic from "next/dynamic";

// Dynamically import to ensure Leaflet runs only on client
const EEMap = dynamic(() => import("@/components/EEMap"), { ssr: false });

export default function Home() {
  return <EEMap />;
}
