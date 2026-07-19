import React from "react";
import { View, Text, StyleSheet } from "react-native";
import Svg, { Polygon, Line, Text as SvgText, Circle } from "react-native-svg";
import { COLORS } from "../theme/colors";

interface SpiderChartProps {
  form: number | null;
  impact: number | null;
  threat: number | null;
  bigMoments: number | null;
  reliability: number | null;
  discipline: number | null;
  size?: number;
}

export const SpiderChart: React.FC<SpiderChartProps> = ({
  form,
  impact,
  threat,
  bigMoments,
  reliability,
  discipline,
  size = 200,
}) => {
  const axes = [
    { label: "Form", value: form },
    { label: "Impact", value: impact },
    { label: "Threat", value: threat },
    { label: "Big Moments", value: bigMoments },
    { label: "Reliability", value: reliability },
    { label: "Discipline", value: discipline },
  ];

  const hasData = axes.some(a => a.value !== null);

  if (!hasData) {
    return (
      <View style={[styles.fallbackContainer, { width: size, height: size }]}>
        <Text style={styles.fallbackText}>Not enough data</Text>
      </View>
    );
  }

  const center = size / 2;
  const radius = (size / 2) * 0.7; // leave margins for labels

  // Coordinates of 6 points of hexagon
  const pointsCount = 6;
  const angleStep = (2 * Math.PI) / pointsCount;

  // Calculate coordinates for grid rings (e.g. 25, 50, 75, 100)
  const rings = [0.25, 0.5, 0.75, 1.0];
  const gridRings = rings.map((ring) => {
    const ringRadius = radius * ring;
    const ringPoints = [];
    for (let i = 0; i < pointsCount; i++) {
      const angle = i * angleStep - Math.PI / 2; // start from top
      const x = center + ringRadius * Math.cos(angle);
      const y = center + ringRadius * Math.sin(angle);
      ringPoints.push(`${x},${y}`);
    }
    return ringPoints.join(" ");
  });

  // Calculate coordinates of the values polygon
  const valuePoints = [];
  const validAxes = [];

  for (let i = 0; i < pointsCount; i++) {
    const axis = axes[i];
    const angle = i * angleStep - Math.PI / 2;
    
    // Default to 0 if null to draw a valid polygon but label axis appropriately
    const val = axis.value !== null ? axis.value : 0;
    const valRadius = radius * (val / 100);
    const x = center + valRadius * Math.cos(angle);
    const y = center + valRadius * Math.sin(angle);
    valuePoints.push(`${x},${y}`);
    
    if (axis.value !== null) {
      validAxes.push(axis.label);
    }
  }

  const polygonStr = valuePoints.join(" ");

  // Axis lines and labels coordinates
  const gridLines = [];
  const labels = [];

  for (let i = 0; i < pointsCount; i++) {
    const axis = axes[i];
    const angle = i * angleStep - Math.PI / 2;
    
    const targetX = center + radius * Math.cos(angle);
    const targetY = center + radius * Math.sin(angle);
    
    gridLines.push({ x1: center, y1: center, x2: targetX, y2: targetY });

    // Put labels slightly further out than radius
    const labelX = center + (radius + 20) * Math.cos(angle);
    const labelY = center + (radius + 15) * Math.sin(angle);
    
    // Add value if present
    const valText = axis.value !== null ? `${axis.value}` : "—";
    
    labels.push({
      text: `${axis.label}`,
      value: valText,
      x: labelX,
      y: labelY,
      anchor: i === 0 || i === 3 ? "middle" : i < 3 ? "start" : "end",
    });
  }

  return (
    <View style={styles.container}>
      <Svg width={size} height={size}>
        {/* Draw grid rings */}
        {gridRings.map((ringStr, idx) => (
          <Polygon
            key={idx}
            points={ringStr}
            fill="none"
            stroke="rgba(0, 0, 0, 0.05)"
            strokeWidth={1}
          />
        ))}

        {/* Draw grid axes */}
        {gridLines.map((line, idx) => (
          <Line
            key={idx}
            x1={line.x1}
            y1={line.y1}
            x2={line.x2}
            y2={line.y2}
            stroke="rgba(0, 0, 0, 0.05)"
            strokeWidth={1}
          />
        ))}

        {/* Draw values polygon */}
        <Polygon
          points={polygonStr}
          fill="rgba(45, 101, 61, 0.25)"
          stroke={COLORS.green || "#2d653d"}
          strokeWidth={2}
        />

        {/* Draw axis labels */}
        {labels.map((lbl, idx) => (
          <SvgText
            key={idx}
            x={lbl.x}
            y={lbl.y}
            fontSize={9}
            fontWeight="bold"
            fill={COLORS.ink || "#0f172a"}
            textAnchor={lbl.anchor as any}
          >
            {lbl.text}
          </SvgText>
        ))}
      </Svg>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    justifyContent: "center",
  },
  fallbackContainer: {
    alignItems: "center",
    justifyContent: "center",
    borderColor: "rgba(0, 0, 0, 0.05)",
    borderWidth: 1,
    borderRadius: 8,
    backgroundColor: "#fafaf9",
  },
  fallbackText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#a8a29e",
  },
});
