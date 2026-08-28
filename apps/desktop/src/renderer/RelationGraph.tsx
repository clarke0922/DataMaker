import { useMemo } from "react";
import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { MetadataTableOptionDto, RelationDto } from "@datamaker/contracts";

export function RelationGraph({
  tables,
  relations,
}: {
  tables: MetadataTableOptionDto[];
  relations: RelationDto[];
}) {
  const nodes = useMemo<Node[]>(() => {
    const related = new Set(
      relations.flatMap((relation) => [
        relation.sourceTableId,
        relation.targetTableId,
      ]),
    );
    return tables
      .filter((table) => !table.retired && related.has(table.id))
      .map((table, index) => ({
        id: table.id,
        position: { x: (index % 5) * 230, y: Math.floor(index / 5) * 130 },
        data: { label: `${table.schemaName}.${table.name}` },
        style: {
          width: 190,
          borderRadius: 8,
          border: "1px solid #3b82f6",
          background: "#111827",
          color: "#e5e7eb",
          fontSize: 12,
        },
      }));
  }, [tables, relations]);
  const nodeIds = useMemo(() => new Set(nodes.map((node) => node.id)), [nodes]);
  const edges = useMemo<Edge[]>(
    () =>
      relations
        .filter(
          (relation) =>
            nodeIds.has(relation.sourceTableId) &&
            nodeIds.has(relation.targetTableId) &&
            relation.status !== "rejected",
        )
        .map((relation) => ({
          id: relation.id,
          source: relation.sourceTableId,
          target: relation.targetTableId,
          label: relation.columnMappings.join(", ") || relation.relationType,
          animated: relation.status === "candidate",
          markerEnd: { type: MarkerType.ArrowClosed },
          style: {
            stroke:
              relation.origin === "physical"
                ? "#60a5fa"
                : relation.origin === "manual"
                  ? "#34d399"
                  : "#f59e0b",
          },
          labelStyle: { fill: "#94a3b8", fontSize: 10 },
        })),
    [relations, nodeIds],
  );
  return (
    <div style={{ height: 420, width: "100%" }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        fitView
        nodesDraggable
        attributionPosition="bottom-left"
      >
        <MiniMap pannable zoomable />
        <Controls />
        <Background gap={18} />
      </ReactFlow>
    </div>
  );
}
