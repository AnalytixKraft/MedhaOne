import { AppPageHeader } from "@/components/erp/app-primitives";
import { cn } from "@/lib/utils";

type PageTitleProps = {
  title: string;
  description: string;
  className?: string;
};

export function PageTitle({ title, description, className }: PageTitleProps) {
  return <AppPageHeader title={title} description={description} className={cn(className)} />;
}
