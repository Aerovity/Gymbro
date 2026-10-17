import { Gallery } from "@/components/dev/Gallery";

export default async function GalleryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const stage = typeof sp.stage === "string" ? sp.stage : undefined;
  return <Gallery stage={stage} />;
}
