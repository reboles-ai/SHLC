import csv, zipfile, os
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.formatting.rule import FormulaRule
R="/home/user/SHLC/lists/"
locs=list(csv.DictReader(open(R+"Locations.csv")))
miles={r["ToLocation"]:r["OneWayMiles"] for r in csv.DictReader(open(R+"Routes.csv"))}
H=Font(bold=True,color="FFFFFF"); HF=PatternFill("solid",fgColor="1F4E78"); CF=PatternFill("solid",fgColor="F2F2F2")
def head(ws,cols,widths):
    ws.append(cols)
    for i,w in enumerate(widths,1):
        c=ws.cell(1,i); c.font=H; c.fill=HF; c.alignment=Alignment(wrap_text=True,vertical="center")
        ws.column_dimensions[c.column_letter].width=w
    ws.freeze_panes="A2"
wb=Workbook()
ws=wb.active; ws.title="Start Here"
for line in ["SHLC Peer Time & Mileage Tracker","",
"PEERS: open the tab with your name. Fill one row per work block or trip.",
"1. Enter Date, Clock In and Clock Out (for example 9:00 AM).",
"2. Pick Activity, From and To from the drop-down lists.",
"3. Round Trip = Yes if you returned to where you started.",
"4. Drove Own Vehicle = Yes only if you were the driver. Passengers get no mileage.",
"5. If From or To is 'Other (not listed)', or Miles shows 0, enter Odometer Start and End.",
"6. Resident ID: ID or initials ONLY. Never a full name.",
"7. Purpose: one short factual sentence.",
"Do not type in the gray columns (Hours, Miles, Mileage $, Flags). They calculate on their own.",
"",
"SUPERVISOR: review each row and its Flags. Type your initials in Approved By and the date in Approved Date.",
"PAYROLL: on the Payroll Summary tab, enter the pay period dates. Only approved rows are counted.",
"ADMIN: on the Locations tab, enter measured one-way miles from SHLC and set Verified to Yes.",
"Until a route is verified, mileage is paid from odometer readings.",
"Commuting between home and SHLC is not reimbursable."]:
    ws.append([line])
ws["A1"].font=Font(bold=True,size=14); ws.column_dimensions["A"].width=110
st=wb.create_sheet("Settings"); head(st,["Setting","Value","Notes"],[22,12,50])
st.append(["Mileage rate ($/mile)",0.76,"Set by Finance"]); st.append(["Max shift hours",12,"Longer shifts are flagged"]); st.append(["Max trip miles",100,"Longer trips are flagged"])
lo=wb.create_sheet("Locations"); head(lo,["Location","ID","Category","Address","City","State","One-Way Miles from SHLC","Verified (Yes/No)","Payable Miles"],[40,10,22,36,16,7,14,12,12])
for i,l in enumerate(locs,2):
    m=miles.get(l["Title"],""); 
    lo.append([l["Title"],l["LocationID"],l["Category"],l["Address"],l["City"],l["State"],float(m) if m else None,"No",f'=IF(AND(H{i}="Yes",ISNUMBER(G{i})),G{i},0)'])
    lo.cell(i,9).fill=CF
n=len(locs)+1
dvv=DataValidation(type="list",formula1='"Yes,No"',allow_blank=True); lo.add_data_validation(dvv); dvv.add(f"H2:H60")
SH="Serenity Hills Life Center"; N=120
cols=["Date","Clock In","Clock Out","Hours","Activity","From","To","Round Trip","Drove Own Vehicle","Odometer Start","Odometer End","Resident ID (no names)","Purpose","Miles","Mileage $","Flags","Approved By","Approved Date"]
wd=[12,10,10,8,14,34,34,8,10,10,10,12,40,8,10,40,10,12]
for p in ["Jenna","Erica","Jacquetta","Weslynn"]:
    s=wb.create_sheet(p); head(s,cols,wd); s.row_dimensions[1].height=32
    for r in range(2,N+2):
        s[f"D{r}"]=f'=IF(OR(B{r}="",C{r}=""),"",ROUND(MOD(C{r}-B{r},1)*24,2))'
        std=f'IF(F{r}="{SH}",IFERROR(VLOOKUP(G{r},Locations!$A$2:$I$60,9,FALSE),0),IF(G{r}="{SH}",IFERROR(VLOOKUP(F{r},Locations!$A$2:$I$60,9,FALSE),0),0))*IF(H{r}="Yes",2,1)'
        odo=f'IF(AND(ISNUMBER(J{r}),ISNUMBER(K{r}),K{r}>=J{r}),K{r}-J{r},0)'
        s[f"N{r}"]=f'=IF(A{r}="","",IF(I{r}<>"Yes",0,IF({std}>0,{std},{odo})))'
        s[f"O{r}"]=f'=IF(A{r}="","",ROUND(N{r}*Settings!$B$2,2))'
        s[f"P{r}"]=(f'=IF(A{r}="","",TRIM(IF(OR(B{r}="",C{r}=""),"Missing time. ","")&IF(N(D{r})>Settings!$B$3,"Long shift. ","")&IF(N(N{r})>Settings!$B$4,"Long trip. ","")'
          f'&IF(OR(F{r}="Other (not listed)",G{r}="Other (not listed)"),"Other location. ","")&IF(AND(I{r}="Yes",{std}=0,N(N{r})>0),"Odometer used. ","")&IF(AND(I{r}="Yes",N(N{r})=0),"No miles - enter odometer. ","")'
          f'&IF(AND(B{r}<>"",C{r}<>"",COUNTIFS($A$2:$A${N+1},A{r},$B$2:$B${N+1},"<"&C{r},$C$2:$C${N+1},">"&B{r})>1),"Overlaps another entry. ","")))')
        for c in "DNOP": s[f"{c}{r}"].fill=CF
        s[f"O{r}"].number_format='"$"#,##0.00'
    for c,f in (("A","mm/dd/yyyy"),("R","mm/dd/yyyy"),("B","h:mm AM/PM"),("C","h:mm AM/PM")): s.column_dimensions[c].number_format=f
    a=DataValidation(type="list",formula1='"Transport,Court,Appointment,Outreach,Group,Admin,Training"',allow_blank=True)
    l=DataValidation(type="list",formula1=f"Locations!$A$2:$A$60",allow_blank=True)
    y=DataValidation(type="list",formula1='"Yes,No"',allow_blank=True)
    for d in (a,l,y): s.add_data_validation(d)
    a.add(f"E2:E{N+1}"); l.add(f"F2:G{N+1}"); y.add(f"H2:I{N+1}")
    s[f"A{N+2}"]="END OF SHEET - do not enter below this line. Ask the Compliance Officer for a new sheet."; s[f"A{N+2}"].font=Font(bold=True,color="C00000")
    s.conditional_formatting.add(f"P2:P{N+1}",FormulaRule(formula=[f'LEN(P2)>0'],font=Font(color="C00000",bold=True)))
pm=wb.create_sheet("Payroll Summary",1)
pm["A1"]="Pay period start"; pm["A2"]="Pay period end"; pm["B1"].number_format=pm["B2"].number_format="mm/dd/yyyy"
pm["D1"]="Enter the pay period dates in B1 and B2. Only rows a supervisor has approved are counted."
for c,t in enumerate(["Peer","Approved Hours","Approved Miles","Mileage $","Rows Awaiting Approval","Rows With Flags"],1):
    x=pm.cell(4,c,t); x.font=H; x.fill=HF; x.alignment=Alignment(wrap_text=True)
for i,p in enumerate(["Jenna","Erica","Jacquetta","Weslynn"],5):
    rng=lambda c: f"{p}!${c}$2:${c}${N+1}"
    cond=f'{rng("A")},">="&$B$1,{rng("A")},"<="&$B$2'
    pm[f"A{i}"]=p
    pm[f"B{i}"]=f'=SUMIFS({rng("D")},{cond},{rng("Q")},"<>")'
    pm[f"C{i}"]=f'=SUMIFS({rng("N")},{cond},{rng("Q")},"<>")'
    pm[f"D{i}"]=f'=SUMIFS({rng("O")},{cond},{rng("Q")},"<>")'
    pm[f"E{i}"]=f'=COUNTIFS({cond},{rng("Q")},"")'
    pm[f"F{i}"]=f'=COUNTIFS({cond},{rng("P")},"?*")'
    pm[f"D{i}"].number_format='"$"#,##0.00'
pm["A9"]="Total"; pm["A9"].font=Font(bold=True)
for c in "BCDEF": pm[f"{c}9"]=f"=SUM({c}5:{c}8)"; pm[f"{c}9"].font=Font(bold=True)
pm["D9"].number_format='"$"#,##0.00'
for c,w in zip("ABCDEF",[18,14,14,14,14,14]): pm.column_dimensions[c].width=w
pm.row_dimensions[4].height=32
wb.save("t.xlsx")
# recompress max
import re
def share(xml):
    si=[0]
    for col in "DNOP":
        pat=re.compile(r'(<c r="%s(\d+)"[^>]*>)<f>(.*?)</f>(<v\s*/>|<v></v>)?</c>'%col,re.S)
        ms=list(pat.finditer(xml))
        if len(ms)<3: continue
        k=si[0]; si[0]+=1; first=int(ms[0].group(2)); last=int(ms[-1].group(2))
        def rep(m):
            if int(m.group(2))==first: return '%s<f t="shared" ref="%s%d:%s%d" si="%d">%s</f></c>'%(m.group(1),col,first,col,last,k,m.group(3))
            return '%s<f t="shared" si="%d"/></c>'%(m.group(1),k)
        xml=pat.sub(rep,xml)
    return xml
zi=zipfile.ZipFile("t.xlsx"); zo=zipfile.ZipFile("SHLC Peer Time and Mileage Tracker.xlsx","w",zipfile.ZIP_DEFLATED,compresslevel=9)
for it in zi.infolist():
    d=zi.read(it.filename)
    if re.match(r"xl/worksheets/sheet[5-8]\.xml",it.filename): d=share(d.decode()).encode()
    zo.writestr(it.filename,d)
zo.close(); print(os.path.getsize("t.xlsx"),os.path.getsize("SHLC Peer Time and Mileage Tracker.xlsx"))
