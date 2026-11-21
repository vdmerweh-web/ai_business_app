# Builds seed.json from legacy copies (read only). 13 active accounts.
import openpyxl, pandas as pd, json, datetime as dt
L='/workspace/grid_bot/legacy/'
wb=openpyxl.load_workbook(L+'legacy_clients.xlsx',data_only=True)
rows=list(wb['Summary'].iter_rows(values_only=True))
hdr=rows[4]; S=[dict(zip(hdr,r)) for r in rows[5:] if r[0] and r[6]=='Active']
con=pd.read_csv(L+'src/Contracts.txt',encoding='cp1252')
con['EndDate']=pd.to_datetime(con['EndDate'],format='%Y/%m/%d %H:%M:%S',errors='coerce')
con['StartDate']=pd.to_datetime(con['StartDate'],format='%Y/%m/%d %H:%M:%S',errors='coerce')
today=pd.Timestamp('2026-10-18'); out=[]
for s in S:
    ws=wb[s['Sheet']]; tx=[]
    for r in list(ws.iter_rows(values_only=True))[5:]:
        if not isinstance(r[0],dt.datetime) or r[0]<dt.datetime(2026,1,1): continue
        tx.append(dict(date=r[0].strftime('%Y-%m-%d'),desc=r[1],inv=r[2],debit=r[3] or 0,credit=r[4] or 0,other=r[6]))
    c=con[(con.AccountID==s['ID'])&((con.EndDate.isna())|(con.EndDate>today))]
    cs=[dict(legacy_id=int(x.ContractID),amount=float(x.Cost),start=x.StartDate.strftime('%Y-%m-%d'),freq='monthly',description='Contract Fee') for x in c.itertuples()]
    ob=float(s['Opening balance 2026-01-01']); cur=float(s['Current balance'])
    chk=ob+sum(t['debit']-t['credit'] for t in tx)
    assert abs(chk-cur)<0.01,(s['Account'],chk,cur)
    out.append(dict(legacy_id=s['ID'],name=s['Account'],contact=s['Contact'],email=s['Email'],cell=s['Cell'],ref='PG%03d'%s['ID'],opening=ob,current=cur,contracts=cs,tx=tx))
json.dump(dict(next_invoice_no=5277,clients=out),open('seed/seed.json','w'),indent=1,default=str)
print(len(out),sum(c['current'] for c in out),sum(c['opening'] for c in out))
