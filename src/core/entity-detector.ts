import type { Summary, ExtractedEntity, ServiceItem } from "./compaction-engine.js";

export interface DetectedItem {
  type: "entity" | "service" | "pattern" | "knowledge";
  name: string;
  data: unknown;
  vaultPath: string;
  content: string;
}

export class EntityDetector {
  /**
   * Analyzes a summary and determines what should be added to the vault.
   */
  detect(summary: Summary): DetectedItem[] {
    const items: DetectedItem[] = [];

    // Detect entities
    for (const entity of summary.entities) {
      items.push(this.createEntityItem(entity));

      // Also create service entries for entity-related services
      const relatedServices = summary.services.filter(
        (s) =>
          s.name.toLowerCase().includes(entity.name.toLowerCase()) ||
          s.location?.toLowerCase().includes(entity.name.toLowerCase())
      );

      for (const service of relatedServices) {
        items.push(this.createServiceItem(entity.name, service));
      }
    }

    // Detect standalone services
    const processedServiceNames = new Set<string>();
    for (const entity of summary.entities) {
      for (const service of summary.services) {
        if (
          service.name.toLowerCase().includes(entity.name.toLowerCase()) ||
          service.location?.toLowerCase().includes(entity.name.toLowerCase())
        ) {
          processedServiceNames.add(service.name);
        }
      }
    }

    for (const service of summary.services) {
      if (!processedServiceNames.has(service.name)) {
        items.push(this.createStandaloneServiceItem(service));
      }
    }

    // Detect architecture patterns
    for (const arch of summary.architecture) {
      items.push(this.createArchitectureItem(arch));
    }

    // Detect general knowledge
    for (const knowledge of summary.knowledge) {
      items.push(this.createKnowledgeItem(knowledge));
    }

    return items;
  }

  private createEntityItem(entity: ExtractedEntity): DetectedItem {
    const content = this.formatEntityContent(entity);

    return {
      type: "entity",
      name: entity.name,
      data: entity,
      vaultPath: `entities/${entity.name.toLowerCase()}`,
      content,
    };
  }

  private createServiceItem(
    entityName: string,
    service: ServiceItem
  ): DetectedItem {
    const content = this.formatServiceContent(service);
    const serviceName = service.name.toLowerCase().replace(entityName.toLowerCase(), "").trim();
    const fileName = serviceName || "service";

    return {
      type: "service",
      name: service.name,
      data: service,
      vaultPath: `entities/${entityName.toLowerCase()}/services/${fileName}`,
      content,
    };
  }

  private createStandaloneServiceItem(service: ServiceItem): DetectedItem {
    const content = this.formatServiceContent(service);

    return {
      type: "service",
      name: service.name,
      data: service,
      vaultPath: `services/${service.name.toLowerCase()}`,
      content,
    };
  }

  private createArchitectureItem(arch: {
    pattern: string;
    description: string;
    affectedFiles: string[];
  }): DetectedItem {
    const content = `## ${arch.pattern}

${arch.description}

### Affected Files
${arch.affectedFiles.map((f) => `- ${f}`).join("\n")}
`;

    return {
      type: "pattern",
      name: arch.pattern,
      data: arch,
      vaultPath: "architecture",
      content,
    };
  }

  private createKnowledgeItem(knowledge: {
    topic: string;
    details: string;
  }): DetectedItem {
    const content = `## ${knowledge.topic}

${knowledge.details}
`;

    return {
      type: "knowledge",
      name: knowledge.topic,
      data: knowledge,
      vaultPath: "general-knowledge",
      content,
    };
  }

  private formatEntityContent(entity: ExtractedEntity): string {
    let content = `# ${entity.name}\n\n`;

    if (entity.location) {
      content += `**Location**: ${entity.location}\n\n`;
    }

    if (entity.attributes.length > 0) {
      content += `## Attributes\n\n`;
      for (const attr of entity.attributes) {
        content += `- ${attr}\n`;
      }
      content += "\n";
    }

    if (entity.relations.length > 0) {
      content += `## Relations\n\n`;
      for (const rel of entity.relations) {
        content += `- ${rel}\n`;
      }
      content += "\n";
    }

    return content;
  }

  private formatServiceContent(service: ServiceItem): string {
    let content = `# ${service.name}\n\n`;

    if (service.location) {
      content += `**Location**: ${service.location}\n\n`;
    }

    if (service.purpose) {
      content += `## Purpose\n\n${service.purpose}\n\n`;
    }

    if (service.methods.length > 0) {
      content += `## Methods\n\n`;
      for (const method of service.methods) {
        content += `- ${method}\n`;
      }
      content += "\n";
    }

    return content;
  }
}
