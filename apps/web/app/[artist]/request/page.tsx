import { IntakeFlow } from "@/components/IntakeFlow";
import { ARTIST } from "@/lib/mock";

export default async function RequestPage({ params }: { params: Promise<{ artist: string }> }) {
  const { artist } = await params;
  return <IntakeFlow handle={artist || ARTIST.handle} />;
}
