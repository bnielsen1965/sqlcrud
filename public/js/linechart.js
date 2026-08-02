/**
 * Minimal line chart library for rendering time-series data on a canvas.
 * Supports multiple datasets, auto-scaling, tooltips, and responsive resizing.
 */
(function (global) {
  'use strict';

  const DEFAULTS = {
    padding: { top: 30, right: 15, bottom: 35, left: 50 },
    gridColor: 'rgba(0, 0, 0, 0.07)',
    axisColor: '#999',
    textColor: '#555',
    fontSize: 10,
    fontFamily: 'system-ui, -apple-system, sans-serif',
    tooltipBg: 'rgba(0, 0, 0, 0.8)',
    tooltipText: '#fff',
    tooltipPadding: 6,
    maxXTicks: 8,
    maxYTicks: 6,
    animation: false
  };

  class LineChart {
    constructor(canvas, options = {}) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.options = { ...DEFAULTS, ...options };
      this.datasets = [];
      this.labels = [];
      this.tooltip = null;
      this.resizeObserver = null;
      this.init();
    }

    init() {
      this.handleResize = this.handleResize.bind(this);
      this.handleMouseMove = this.handleMouseMove.bind(this);
      this.handleMouseLeave = this.handleMouseLeave.bind(this);

      // Set initial size
      this.setSize(this.canvas.parentElement.clientWidth, this.canvas.parentElement.clientHeight);

      // Watch for container size changes
      this.resizeObserver = new ResizeObserver(entries => {
        for (const entry of entries) {
          this.setSize(entry.contentRect.width, entry.contentRect.height);
        }
      });
      this.resizeObserver.observe(this.canvas.parentElement);

      // Mouse events for tooltips
      this.canvas.addEventListener('mousemove', this.handleMouseMove);
      this.canvas.addEventListener('mouseleave', this.handleMouseLeave);
    }

    setSize(width, height) {
      const dpr = window.devicePixelRatio || 1;
      this.canvas.width = width * dpr;
      this.canvas.height = height * dpr;
      this.canvas.style.width = width + 'px';
      this.canvas.style.height = height + 'px';
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.width = width;
      this.height = height;
      this.draw();
    }

    handleResize() {
      this.setSize(this.canvas.parentElement.clientWidth, this.canvas.parentElement.clientHeight);
    }

    /**
     * Update chart data and redraw.
     * @param {object} data - { labels: [timestamps], datasets: [{ label, data, borderColor, backgroundColor, fill, lineWidth }] }
     */
    update(data) {
      this.labels = data.labels || [];
      this.datasets = data.datasets || [];
      this.draw();
    }

    /**
     * Destroy the chart and clean up.
     */
    destroy() {
      if (this.resizeObserver) {
        this.resizeObserver.disconnect();
      }
      this.canvas.removeEventListener('mousemove', this.handleMouseMove);
      this.canvas.removeEventListener('mouseleave', this.handleMouseLeave);
    }

    /**
     * Calculate the chart area (excluding padding).
     */
    getChartArea() {
      const p = this.options.padding;
      return {
        left: p.left,
        top: p.top,
        right: this.width - p.right,
        bottom: this.height - p.bottom,
        width: this.width - p.left - p.right,
        height: this.height - p.top - p.bottom
      };
    }

    /**
     * Compute y-axis scale from all dataset values.
     */
    computeYScale() {
      let min = 0;
      let max = 0;

      for (const ds of this.datasets) {
        for (const v of ds.data) {
          if (v < min) min = v;
          if (v > max) max = v;
        }
      }

      // Ensure y-axis starts at 0 and has some headroom
      min = 0;
      if (max === 0) max = 10;
      else max = Math.ceil(max * 1.1);

      return { min, max };
    }

    /**
     * Generate nicely spaced tick values.
     */
    niceTicks(min, max, count) {
      const range = max - min;
      const roughStep = range / (count - 1);
      const magnitude = Math.pow(10, Math.floor(Math.log10(roughStep)));
      let step = Math.ceil(roughStep / magnitude) * magnitude;

      // Round step to nice numbers
      const niceSteps = [1, 2, 2.5, 5, 10];
      for (const ns of niceSteps) {
        if (step <= ns * magnitude) {
          step = ns * magnitude;
          break;
        }
      }

      const ticks = [];
      for (let v = min; v <= max + step * 0.01; v += step) {
        ticks.push(Math.round(v * 100) / 100);
      }
      return ticks;
    }

    /**
     * Format a timestamp label.
     */
    formatTimeLabel(timestamp, index, total) {
      const date = new Date(timestamp);
      const timeStr = date.toLocaleTimeString([], { minute: '2-digit', second: '2-digit' });
      return timeStr;
    }

    /**
     * Main draw function.
     */
    draw() {
      const ctx = this.ctx;
      const area = this.getChartArea();
      const yScale = this.computeYScale();
      const p = this.options.padding;

      // Clear
      ctx.clearRect(0, 0, this.width, this.height);

      // Background
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, this.width, this.height);

      // Title area (top padding)
      ctx.fillStyle = this.options.textColor;
      ctx.font = this.options.fontSize + 'px ' + this.options.fontFamily;

      // Y-axis ticks
      const yTicks = this.niceTicks(yScale.min, yScale.max, this.options.maxYTicks);

      // Grid lines and y-axis labels
      ctx.strokeStyle = this.options.gridColor;
      ctx.lineWidth = 1;
      ctx.fillStyle = this.options.textColor;
      ctx.font = (this.options.fontSize - 1) + 'px ' + this.options.fontFamily;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';

      for (const tick of yTicks) {
        const y = area.bottom - ((tick - yScale.min) / (yScale.max - yScale.min)) * area.height;
        // Grid line
        ctx.beginPath();
        ctx.moveTo(area.left, y);
        ctx.lineTo(area.right, y);
        ctx.stroke();
        // Label
        ctx.fillText(tick.toString(), area.left - 6, y);
      }

      // X-axis ticks
      const labelCount = this.labels.length;
      const xTickCount = Math.min(labelCount, this.options.maxXTicks);
      const xStep = labelCount > xTickCount ? Math.floor(labelCount / (xTickCount - 1)) : 1;

      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';

      for (let i = 0; i < labelCount; i += xStep) {
        const x = area.left + (i / (labelCount - 1 || 1)) * area.width;
        const label = this.formatTimeLabel(this.labels[i], i, labelCount);
        ctx.fillText(label, x, area.bottom + 6);
      }

      // Axis lines
      ctx.strokeStyle = this.options.axisColor;
      ctx.lineWidth = 1;
      // X-axis
      ctx.beginPath();
      ctx.moveTo(area.left, area.bottom);
      ctx.lineTo(area.right, area.bottom);
      ctx.stroke();
      // Y-axis
      ctx.beginPath();
      ctx.moveTo(area.left, area.top);
      ctx.lineTo(area.left, area.bottom);
      ctx.stroke();

      // Draw datasets
      for (const ds of this.datasets) {
        this.drawDataset(ctx, ds, area, yScale, labelCount);
      }

      // Draw legend
      this.drawLegend(ctx, area);

      // Draw tooltip if active
      if (this.tooltip) {
        this.drawTooltip(ctx);
      }
    }

    /**
     * Draw a single dataset (line, optionally filled).
     */
    drawDataset(ctx, ds, area, yScale, labelCount) {
      const data = ds.data;
      if (!data || data.length === 0) return;

      const lineWidth = ds.lineWidth || 1.5;
      const tension = ds.tension || 0.3;

      // Helper to get point coordinates
      const getPoint = (i) => {
        const x = labelCount > 1
          ? area.left + (i / (labelCount - 1)) * area.width
          : area.left + area.width / 2;
        const y = area.bottom - ((data[i] - yScale.min) / (yScale.max - yScale.min)) * area.height;
        return { x, y };
      };

      // Draw fill area
      if (ds.fill && ds.backgroundColor) {
        ctx.beginPath();
        ctx.moveTo(getPoint(0).x, area.bottom);
        for (let i = 0; i < data.length; i++) {
          const pt = getPoint(i);
          if (i === 0) {
            ctx.lineTo(pt.x, pt.y);
          } else {
            const prev = getPoint(i - 1);
            const cpx = (prev.x + pt.x) / 2;
            ctx.bezierCurveTo(cpx, prev.y, cpx, pt.y, pt.x, pt.y);
          }
        }
        const lastPt = getPoint(data.length - 1);
        ctx.lineTo(lastPt.x, area.bottom);
        ctx.closePath();
        ctx.fillStyle = ds.backgroundColor;
        ctx.fill();
      }

      // Draw line
      ctx.beginPath();
      ctx.strokeStyle = ds.borderColor || '#2196F3';
      ctx.lineWidth = lineWidth;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';

      for (let i = 0; i < data.length; i++) {
        const pt = getPoint(i);
        if (i === 0) {
          ctx.moveTo(pt.x, pt.y);
        } else {
          const prev = getPoint(i - 1);
          const cpx = (prev.x + pt.x) / 2;
          ctx.bezierCurveTo(cpx, prev.y, cpx, pt.y, pt.x, pt.y);
        }
      }
      ctx.stroke();
    }

    /**
     * Draw legend at the top.
     */
    drawLegend(ctx, area) {
      if (this.datasets.length === 0) return;

      ctx.font = this.options.fontSize + 'px ' + this.options.fontFamily;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';

      let x = area.left;
      const y = 12;
      const gap = 16;
      const boxSize = 10;

      for (const ds of this.datasets) {
        // Box
        ctx.fillStyle = ds.borderColor || '#2196F3';
        ctx.fillRect(x, y - boxSize / 2, boxSize, boxSize);

        // Label
        ctx.fillStyle = this.options.textColor;
        ctx.fillText(ds.label || '', x + boxSize + 4, y);

        x += ctx.measureText(ds.label || '').width + boxSize + gap + 4;
      }
    }

    /**
     * Handle mouse move for tooltips.
     */
    handleMouseMove(e) {
      const rect = this.canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const area = this.getChartArea();

      if (mx < area.left || mx > area.right || my < area.top || my > area.bottom) {
        this.tooltip = null;
        this.draw();
        return;
      }

      // Find nearest label index
      const labelCount = this.labels.length;
      if (labelCount === 0) return;

      const ratio = (mx - area.left) / area.width;
      const index = Math.round(ratio * (labelCount - 1));

      this.tooltip = {
        x: mx,
        y: my,
        index: index,
        label: this.labels[index]
      };

      this.draw();
    }

    handleMouseLeave() {
      this.tooltip = null;
      this.draw();
    }

    /**
     * Draw tooltip at the current hover position.
     */
    drawTooltip(ctx) {
      const t = this.tooltip;
      if (!t) return;

      const area = this.getChartArea();
      const labelCount = this.labels.length;
      if (labelCount === 0 || t.index < 0 || t.index >= labelCount) return;

      // Get values at this index
      const lines = [];
      for (const ds of this.datasets) {
        const value = ds.data[t.index];
        if (value !== undefined) {
          lines.push({ label: ds.label, value, color: ds.borderColor });
        }
      }

      if (lines.length === 0) return;

      // Calculate tooltip dimensions
      const padding = this.options.tooltipPadding;
      const fontSize = this.options.fontSize;
      const maxLabelWidth = Math.max(...lines.map(l => ctx.measureText(l.label).width));
      const maxValueWidth = Math.max(...lines.map(l => ctx.measureText(l.value + ' TPM').width));
      const titleWidth = ctx.measureText(new Date(t.label).toLocaleTimeString()).width;
      const tooltipWidth = Math.max(titleWidth, maxLabelWidth + maxValueWidth + 10) + padding * 2;
      const tooltipHeight = (fontSize + 4) + lines.length * (fontSize + 2) + padding * 2;

      // Position tooltip (avoid going off-screen)
      let tx = t.x + 12;
      let ty = t.y - tooltipHeight / 2;
      if (tx + tooltipWidth > this.width) tx = t.x - tooltipWidth - 12;
      if (ty < 0) ty = 4;
      if (ty + tooltipHeight > this.height) ty = this.height - tooltipHeight - 4;

      // Draw vertical guide line
      const guideX = area.left + (t.index / (labelCount - 1 || 1)) * area.width;
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.15)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(guideX, area.top);
      ctx.lineTo(guideX, area.bottom);
      ctx.stroke();
      ctx.setLineDash([]);

      // Draw tooltip background
      ctx.fillStyle = this.options.tooltipBg;
      ctx.beginPath();
      ctx.roundRect(tx, ty, tooltipWidth, tooltipHeight, 4);
      ctx.fill();

      // Draw tooltip text
      ctx.fillStyle = this.options.tooltipText;
      ctx.font = 'bold ' + fontSize + 'px ' + this.options.fontFamily;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(new Date(t.label).toLocaleTimeString(), tx + padding, ty + padding);

      ctx.font = fontSize + 'px ' + this.options.fontFamily;
      let ly = ty + padding + fontSize + 4;
      for (const line of lines) {
        // Color dot
        ctx.fillStyle = line.color || '#2196F3';
        ctx.beginPath();
        ctx.arc(tx + padding + 3, ly + 2, 3, 0, Math.PI * 2);
        ctx.fill();
        // Label
        ctx.fillStyle = this.options.tooltipText;
        ctx.fillText(line.label + ': ' + line.value + ' TPM', tx + padding + 10, ly);
        ly += fontSize + 2;
      }
    }
  }

  // Export
  global.LineChart = LineChart;
})(typeof window !== 'undefined' ? window : this);
