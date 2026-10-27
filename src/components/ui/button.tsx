import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
const buttonVariants = cva("btn",{variants:{variant:{default:"btn-primary",secondary:"btn-secondary",ghost:"btn-ghost",destructive:"btn-danger"},size:{default:"",sm:"btn-sm",icon:"icon-btn"}},defaultVariants:{variant:"default",size:"default"}});
function Button({className,variant,size,asChild=false,...props}:React.ComponentProps<"button"> & VariantProps<typeof buttonVariants> & {asChild?:boolean}) {const Comp=asChild?Slot:"button";return <Comp className={cn(buttonVariants({variant,size,className}))} {...props}/>;}
export {Button,buttonVariants};
