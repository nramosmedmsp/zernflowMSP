// Biblioteca de plantillas de flujos por tipo de negocio. Un archivo por
// plantilla en ./templates; aquí se reúnen, se filtran y se resumen para la
// pantalla de plantillas. La instalación está en ./install.

import type { BusinessTemplate } from "@/lib/types/database";
import { describeSteps, describeTrigger } from "./resolve";
import type { FlowTemplate } from "./types";
import type { BusinessFilter, FlowTemplateSummary } from "./catalog";

import { ecommerceBienvenida } from "./templates/ecommerce-bienvenida";
import { ecommerceCatalogo } from "./templates/ecommerce-catalogo";
import { ecommerceDatosPago } from "./templates/ecommerce-datos-pago";
import { ecommerceRecordatorioPago } from "./templates/ecommerce-recordatorio-pago";
import { ecommerceGraciasCompra } from "./templates/ecommerce-gracias-compra";
import { ecommerceEstadoPedido } from "./templates/ecommerce-estado-pedido";
import { ecommerceEncuesta } from "./templates/ecommerce-encuesta";
import { ecommerceRecompra } from "./templates/ecommerce-recompra";
import { gymBienvenidaSede } from "./templates/gym-bienvenida-sede";
import { gymAgendarVisita } from "./templates/gym-agendar-visita";
import { gymRecordatorioVisita } from "./templates/gym-recordatorio-visita";
import { gymBienvenidaSocio } from "./templates/gym-bienvenida-socio";
import { gymCongelamiento } from "./templates/gym-congelamiento";
import { gymRenovacion } from "./templates/gym-renovacion";
import { gymHorarios } from "./templates/gym-horarios";
import { generalAsesor } from "./templates/general-asesor";
import { generalBaja } from "./templates/general-baja";
import { generalRespuestaDefecto } from "./templates/general-respuesta-defecto";
import { generalBienvenidaSimple } from "./templates/general-bienvenida-simple";
import { generalFaq } from "./templates/general-faq";
import { generalCapturaDatos } from "./templates/general-captura-datos";

export type { FlowTemplate, FlowTemplateBusiness, FlowTemplateNotice, TemplateCatalog } from "./types";
export { BUSINESS_LABELS } from "./types";
export { BUSINESS_FILTERS, categoriesOf, templatesForBusiness } from "./catalog";
export type { BusinessFilter, FlowTemplateSummary } from "./catalog";

export const FLOW_TEMPLATES: readonly FlowTemplate[] = [
  ecommerceBienvenida,
  ecommerceCatalogo,
  ecommerceDatosPago,
  ecommerceRecordatorioPago,
  ecommerceGraciasCompra,
  ecommerceEstadoPedido,
  ecommerceEncuesta,
  ecommerceRecompra,
  gymBienvenidaSede,
  gymAgendarVisita,
  gymRecordatorioVisita,
  gymBienvenidaSocio,
  gymCongelamiento,
  gymRenovacion,
  gymHorarios,
  generalBienvenidaSimple,
  generalAsesor,
  generalRespuestaDefecto,
  generalBaja,
  generalFaq,
  generalCapturaDatos,
];

export function getFlowTemplate(id: unknown): FlowTemplate | undefined {
  return typeof id === "string" ? FLOW_TEMPLATES.find((t) => t.id === id) : undefined;
}

/** Negocio con el que abre la pantalla: el del espacio (`settings.business_template`), o todos. */
export function defaultBusinessFilter(businessTemplate: BusinessTemplate | string | null | undefined): BusinessFilter {
  return businessTemplate === "ecommerce" || businessTemplate === "gym" ? businessTemplate : "all";
}

export function summarizeTemplate(template: FlowTemplate): FlowTemplateSummary {
  return {
    id: template.id,
    name: template.name,
    description: template.description,
    business: template.business,
    category: template.category,
    trigger: describeTrigger(template),
    steps: describeSteps(template),
    adjust: template.adjust,
    requires: (template.requires ?? []).flatMap((id) => {
      const required = getFlowTemplate(id);
      return required ? [{ id: required.id, name: required.name }] : [];
    }),
    nodeCount: template.graph.nodes.length,
  };
}
