import { TableScreenSkeleton } from "@/components/ui/screen-skeletons";

export default function Loading() {
  return <TableScreenSkeleton columns={5} rows={8} />;
}
