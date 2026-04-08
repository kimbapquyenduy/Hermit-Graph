# Brain Dump — Tổng Kết Session

Chạy cuối session để đảm bảo không quên lưu gì.

## Quy trình
1. Review toàn bộ conversation trong session hiện tại
2. Liệt kê những gì ĐÁNG NHỚ theo 4 tiers v2:
   - **BIZ tier**: biz-domain, biz-rule, biz-flow, biz-entity (domain, rule, flow, core entity)
   - **PATTERN tier**: pattern-code, pattern-arch, pattern-integration (code/arch/integration pattern)
   - **TECH tier**: tech-stack, tech-config, tech-person, tech-decision (stack, config, người, decision)
   - **INCIDENT tier**: incident-bug, incident-gotcha (bug fix, gotcha, lesson learned)
3. Với mỗi item → check đã lưu vào memory chưa (`search_nodes`)
4. Chưa lưu → lưu ngay (`create_entities`, `create_relations`, `add_observations`)
   - Đặt tên theo format `TIER:SCOPE:LABEL` (BIZ:Project, RULE:Project:Name, TECH:Tool, INCIDENT:Project:Desc...)
5. Output summary

## Output format
```
Brain Dump — Session Summary

Da luu:
  [Entity/Relation/Observation 1]
  [Entity/Relation/Observation 2]

Da co san (khong can luu lai):
  - [Entity da ton tai]

Stats: X entities moi, Y relations moi, Z observations moi
```
