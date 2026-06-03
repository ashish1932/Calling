// SVG-based Responsive Chart Rendering Engine

class ChartRenderer {
  #observers = new Map();

  constructor() {}

  // Escape text helper for SVG rendering safety (Bug #24)
  #escape(text) {
    if (!text && text !== 0) return '';
    return text.toString()
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  // Helper to resolve CSS variables into Hex for clean export compatibility (Gap 16)
  #resolveColor(colorVal) {
    if (!colorVal || !colorVal.startsWith('var(')) return colorVal;
    const varName = colorVal.replace(/^var\(/, '').replace(/\)$/, '').trim();
    return getComputedStyle(document.body).getPropertyValue(varName).trim() || colorVal;
  }

  // Setup Observer to handle responsive container shifts (Bug #22)
  #observeResize(containerId, redrawFunc) {
    if (this.#observers.has(containerId)) {
      return; // Already observing
    }
    const container = document.getElementById(containerId);
    if (!container) return;

    const observer = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        // Prevent loops by only redrawing when active screen matches or is visible
        if (container.clientWidth > 0) {
          redrawFunc();
        }
      });
    });
    observer.observe(container);
    this.#observers.set(containerId, observer);
  }

  // Render weekly workload bar chart using programmatic SVG nodes (Bug #24, Bug #22)
  renderBarChart(containerId, data) {
    // Attach resize observer once
    this.#observeResize(containerId, () => this.renderBarChart(containerId, data));

    const container = document.getElementById(containerId);
    if (!container) return;

    const width = container.clientWidth || 400;
    const height = container.clientHeight || 280;
    const padding = 40;
    
    const chartWidth = width - padding * 2;
    const chartHeight = height - padding * 2;
    
    const maxCalls = Math.max(...data.map(d => d.calls)) * 1.15; // 15% top padding
    
    // Gap 1: Bar Chart Breaks on Zero Data (NaN Crash)
    if (maxCalls === 0) {
      container.innerHTML = '<div style="display:flex; height:100%; align-items:center; justify-content:center; color:var(--text-muted); font-size:12px;">No session data available this period</div>';
      return;
    }
    const barWidth = (chartWidth / data.length) * 0.6;
    const barSpacing = (chartWidth / data.length) * 0.4;
    
    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("class", "chart-svg");
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", "100%");
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);

    // Create defs gradient
    const defs = document.createElementNS(svgNS, "defs");
    const grad = document.createElementNS(svgNS, "linearGradient");
    grad.setAttribute("id", "bar-grad");
    grad.setAttribute("x1", "0");
    grad.setAttribute("y1", "0");
    grad.setAttribute("x2", "0");
    grad.setAttribute("y2", "1");
    
    const stop1 = document.createElementNS(svgNS, "stop");
    stop1.setAttribute("offset", "0%");
    stop1.setAttribute("stop-color", this.#resolveColor("var(--accent-blue)"));
    
    const stop2 = document.createElementNS(svgNS, "stop");
    stop2.setAttribute("offset", "100%");
    stop2.setAttribute("stop-color", this.#resolveColor("var(--accent-indigo)"));
    
    grad.appendChild(stop1);
    grad.appendChild(stop2);
    defs.appendChild(grad);
    svg.appendChild(defs);

    const fragment = document.createDocumentFragment();

    // 1. Draw horizontal grid lines and vertical labels
    const gridLines = 4;
    for (let i = 0; i <= gridLines; i++) {
      const y = padding + (chartHeight / gridLines) * i;
      const val = Math.round(maxCalls - (maxCalls / gridLines) * i);
      
      const line = document.createElementNS(svgNS, "line");
      line.setAttribute("class", "chart-grid-line");
      line.setAttribute("x1", padding.toString());
      line.setAttribute("y1", y.toString());
      line.setAttribute("x2", (width - padding).toString());
      line.setAttribute("y2", y.toString());
      
      const text = document.createElementNS(svgNS, "text");
      text.setAttribute("class", "chart-text");
      text.setAttribute("x", (padding - 14).toString());
      text.setAttribute("y", (y + 4).toString());
      text.setAttribute("text-anchor", "end");
      text.textContent = val.toString();
      
      fragment.appendChild(line);
      fragment.appendChild(text);
    }

    // 2. Draw bars and bottom labels
    data.forEach((d, idx) => {
      const x = padding + (idx * (chartWidth / data.length)) + barSpacing / 2;
      const valHeight = (d.calls / maxCalls) * chartHeight;
      const y = padding + chartHeight - valHeight;
      
      const rect = document.createElementNS(svgNS, "rect");
      rect.setAttribute("class", "chart-bar");
      rect.setAttribute("x", x.toString());
      rect.setAttribute("y", y.toString());
      rect.setAttribute("width", barWidth.toString());
      rect.setAttribute("height", valHeight.toString());
      rect.setAttribute("fill", "url(#bar-grad)");
      rect.setAttribute("rx", "4");
      rect.style.cursor = "pointer";
      rect.addEventListener("click", () => {
        if (window.CounselFlow && window.CounselFlow.app) {
           window.CounselFlow.app.showToast("Drill Down", `Filtering to sessions on ${d.day}`, "info");
        }
      });
      
      const textDay = document.createElementNS(svgNS, "text");
      textDay.setAttribute("class", "chart-axis-text");
      textDay.setAttribute("x", (x + barWidth / 2).toString());
      textDay.setAttribute("y", (height - padding + 18).toString());
      textDay.setAttribute("text-anchor", "middle");
      textDay.textContent = this.#escape(d.day);
      
      const textCalls = document.createElementNS(svgNS, "text");
      textCalls.setAttribute("class", "chart-axis-text");
      textCalls.setAttribute("x", (x + barWidth / 2).toString());
      textCalls.setAttribute("y", (y - 8).toString());
      textCalls.setAttribute("text-anchor", "middle");
      textCalls.setAttribute("font-weight", "700");
      textCalls.setAttribute("fill", this.#resolveColor("var(--text-primary)"));
      textCalls.textContent = this.#escape(d.calls);
      
      fragment.appendChild(rect);
      fragment.appendChild(textDay);
      fragment.appendChild(textCalls);
    });

    svg.appendChild(fragment);
    container.innerHTML = "";
    container.appendChild(svg);
  }

  // Render language distribution donut chart using programmatically built SVG nodes (Bug #23, Performance #63)
  // Gap 4: Donut Chart Center Label
  renderDonutChart(containerId, data, centerLabel = "Total Cases") {
    // Attach resize observer once
    this.#observeResize(containerId, () => this.renderDonutChart(containerId, data, centerLabel));

    const container = document.getElementById(containerId);
    if (!container) return;

    const width = container.clientWidth || 300;
    const height = container.clientHeight || 280;
    const size = Math.min(width, height);
    const radius = size * 0.35;
    const cx = width / 2;
    const cy = height / 2;
    const strokeWidth = 20;
    
    // Performance #39: Compute static totals once
    const total = data.reduce((sum, d) => sum + d.value, 0);
    if (total === 0) {
      container.innerHTML = '<div style="display:flex; height:100%; align-items:center; justify-content:center; color:var(--text-muted); font-size:12px;">No language data available</div>';
      return;
    }
    
    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("class", "chart-svg");
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", "100%");
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);

    const fragment = document.createDocumentFragment();
    let accumulatedPercentage = 0;
    let legendsHtml = '';

    data.forEach((d) => {
      const percentage = d.value / total;
      const circumference = 2 * Math.PI * radius;
      const strokeDashArray = `${(percentage * circumference)} ${circumference}`;
      const rotationAngle = (accumulatedPercentage * 360) - 90; // Start top
      
      const segment = document.createElementNS(svgNS, "circle");
      segment.setAttribute("class", "donut-segment");
      segment.setAttribute("cx", cx.toString());
      segment.setAttribute("cy", cy.toString());
      segment.setAttribute("r", radius.toString());
      segment.setAttribute("stroke", this.#resolveColor(d.color));
      segment.setAttribute("stroke-dasharray", strokeDashArray);
      segment.setAttribute("stroke-dashoffset", "0");
      segment.setAttribute("transform", `rotate(${rotationAngle} ${cx} ${cy})`);
      segment.setAttribute("fill", "none");
      segment.setAttribute("stroke-width", strokeWidth.toString());
      segment.style.cursor = "pointer";
      segment.addEventListener("click", () => {
         if (window.CounselFlow && window.CounselFlow.app && window.CounselFlow.app.switchScreen) {
           window.CounselFlow.app.switchScreen("patients");
           if (window.CounselFlow.app.dom.patientSearchInput) {
             window.CounselFlow.app.dom.patientSearchInput.value = d.label;
             window.CounselFlow.app.dom.patientSearchInput.dispatchEvent(new Event('input'));
           }
         }
      });
      
      fragment.appendChild(segment);
      accumulatedPercentage += percentage;
      
      legendsHtml += `
        <div class="legend-item">
          <div class="legend-color" style="background: ${d.color};"></div>
          <span>${this.#escape(d.label)}: <strong>${d.value}</strong> (${Math.round(percentage * 100)}%)</span>
        </div>
      `;
    });

    // 3. Central labels overlay text
    const innerCircle = document.createElementNS(svgNS, "circle");
    innerCircle.setAttribute("cx", cx.toString());
    innerCircle.setAttribute("cy", cy.toString());
    innerCircle.setAttribute("r", (radius - strokeWidth).toString());
    innerCircle.setAttribute("fill", "var(--bg-darkest)");
    
    const textLabel = document.createElementNS(svgNS, "text");
    textLabel.setAttribute("class", "chart-text");
    textLabel.setAttribute("x", cx.toString());
    textLabel.setAttribute("y", (cy - 4).toString());
    textLabel.setAttribute("font-size", "11");
    textLabel.setAttribute("fill", this.#resolveColor("var(--text-secondary)"));
    textLabel.setAttribute("text-anchor", "middle");
    textLabel.textContent = centerLabel;
    
    const textVal = document.createElementNS(svgNS, "text");
    textVal.setAttribute("class", "chart-text");
    textVal.setAttribute("x", cx.toString());
    textVal.setAttribute("y", (cy + 16).toString());
    textVal.setAttribute("font-size", "20");
    textVal.setAttribute("font-weight", "700");
    textVal.setAttribute("fill", this.#resolveColor("var(--text-primary)"));
    textVal.setAttribute("text-anchor", "middle");
    textVal.textContent = total.toString();
    
    fragment.appendChild(innerCircle);
    fragment.appendChild(textLabel);
    fragment.appendChild(textVal);
    svg.appendChild(fragment);

    container.innerHTML = "";
    container.appendChild(svg);
    
    const legendBox = document.createElement('div');
    legendBox.className = 'chart-legends';
    legendBox.style.cssText = 'display:flex; flex-wrap:wrap; justify-content:center; gap:12px; margin-top:20px;';
    legendBox.innerHTML = legendsHtml;
    container.appendChild(legendBox);
  }

  // Draw relapse risk progress rows
  renderRiskIndicatorProgress(containerId, data) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const total = data.reduce((sum, d) => sum + d.value, 0);
    
    if (total === 0) {
      container.innerHTML = '<div style="padding:20px; text-align:center; color:var(--text-muted); font-size:12px;">No risk assessment data available</div>';
      return;
    }
    
    let html = '';
    data.forEach(d => {
      const percentage = Math.round((d.value / total) * 100);
      
      // Escape all fields safely
      const escapedLabel = this.#escape(d.label);
      
      // Gap 13: Relapse Risk Progress Bars Trend Arrows
      let trendHtml = '';
      if (d.trend === 'up') trendHtml = '<span style="color:var(--accent-red); margin-left:6px;" title="Worsening trend">↑</span>';
      else if (d.trend === 'down') trendHtml = '<span style="color:var(--accent-green); margin-left:6px;" title="Improving trend">↓</span>';
      else trendHtml = '<span style="color:var(--text-muted); margin-left:6px;" title="Stable trend">→</span>';

      html += `
        <div style="flex-grow: 1; cursor:pointer;" onclick="if(window.CounselFlow && window.CounselFlow.app){ window.CounselFlow.app.switchScreen('patients'); window.CounselFlow.app.dom.patientSearchInput.value = '${escapedLabel.split(' ')[0]}'; window.CounselFlow.app.dom.patientSearchInput.dispatchEvent(new Event('input')); }">
          <div style="display: flex; justify-content: space-between; align-items:center; font-size: 11px; margin-bottom: 6px;">
            <span>${escapedLabel}</span>
            <strong style="display:flex; align-items:center;">${d.value} Cases (${percentage}%) ${trendHtml}</strong>
          </div>
          <div class="progress-bar-container" style="width: 100%; height: 8px;">
            <div class="progress-fill" style="width: ${percentage}%; background: ${this.#resolveColor(d.color)};"></div>
          </div>
        </div>
      `;
    });
    
    container.innerHTML = html;
  }

  // Release Observers on tear-down
  cleanup() {
    this.#observers.forEach(obs => obs.disconnect());
    this.#observers.clear();
  }
}

// Namespace consolidation
window.CounselFlow = window.CounselFlow || {};
window.CounselFlow.chartRenderer = new ChartRenderer();
