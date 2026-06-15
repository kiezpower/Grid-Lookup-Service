export interface GridOperator {
  id: string;
  mastrNummer: string;
  name: string;
  bdewId: string | null;
  street: string | null;
  houseNumber: string | null;
  zipCode: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  acerCode: string | null;
  isClosedGrid: boolean;
  status: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface GridOperatorInsert {
  mastrNummer: string;
  name: string;
  bdewId?: string;
  street?: string;
  houseNumber?: string;
  zipCode?: string;
  city?: string;
  state?: string;
  country?: string;
  email?: string;
  acerCode?: string;
  isClosedGrid?: boolean;
  status?: string;
}

export interface ZipOperatorMapping {
  id: string;
  plz: string;
  gridOperatorId: string;
  voteCount: number;
  createdAt: Date;
}

export interface ZipOperatorMappingInsert {
  plz: string;
  gridOperatorId: string;
  voteCount: number;
}
